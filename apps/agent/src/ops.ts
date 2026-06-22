import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, unlinkSync } from 'fs';
import { exec as execSync } from 'child_process';
import path from 'path';

const exec = promisify(execFile);

// Paths from the install script
const OVPN_DIR = '/etc/openvpn/xor';
const ADMIN_DIR = '/root/ovpn-xor-admin';
const OVPN_BIN = '/usr/local/sbin/openvpn';

export interface OpenVpnStatus {
  openvpn: 'RUNNING' | 'STOPPED' | 'ERROR';
  version?: string;
  xorMask?: string;
  connectedClients: number;
  uptime: number;
  port: number;
  protocol: 'udp' | 'tcp';
}

export interface OpenVpnDetails {
  connectedClients?: number;
  cpu?: number;
  memory?: number;
  disk?: number;
  uptime?: number;
}

export interface CreateClientResult {
  success: true;
  client: {
    name: string;
    fingerprint: string;
    ovpnContent: string;
    createdAt: string;
  };
}

export class OpenVpnOps {
  /**
   * Get OpenVPN service status
   */
  async getStatus(): Promise<OpenVpnStatus> {
    try {
      // Check systemd status
      const { stdout: systemctlOutput } = await exec('systemctl', ['is-active', 'openvpn-xor']);
      const isActive = systemctlOutput.trim() === 'active';

      if (!isActive) {
        return {
          openvpn: 'STOPPED',
          connectedClients: 0,
          uptime: 0,
          port: 443,
          protocol: 'udp',
        };
      }

      // Get OpenVPN version
      let version: string = '2.7.3';
      try {
        const { stdout: versionOutput } = await exec(OVPN_BIN, ['--version']);
        const versionMatch = versionOutput.match(/OpenVPN (\d+\.\d+\.\d+)/);
        if (versionMatch?.[1]) {
          version = versionMatch[1];
        }
      } catch (e) {
        // Keep default version
      }

      // Get XOR mask from config
      let xorMask = '';
      try {
        const { stdout: configOutput } = await exec('cat', [`${OVPN_DIR}/server.conf`]);
        const xorMatch = configOutput.match(/scramble xormask (\S+)/);
        xorMask = xorMatch?.[1] || '';
      } catch (e) {
        xorMask = '';
      }

      // Get connected clients from status file
      const connectedClients = await this.getConnectedClientCount();

      // Get uptime
      let uptime = 0;
      try {
        const { stdout: uptimeOutput } = await exec('systemctl', ['show', 'openvpn-xor', '--property=ExecMainStartTimestamp', '--value']);
        if (uptimeOutput.trim()) {
          const startTime = new Date(uptimeOutput.trim());
          uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
        }
      } catch (e) {
        uptime = 0;
      }

      return {
        openvpn: 'RUNNING',
        version,
        xorMask,
        connectedClients,
        uptime,
        port: 443,
        protocol: 'udp',
      };
    } catch (error) {
      return {
        openvpn: 'ERROR',
        connectedClients: 0,
        uptime: 0,
        port: 443,
        protocol: 'udp',
      };
    }
  }

  /**
   * Get detailed system stats
   */
  async getDetails(): Promise<OpenVpnDetails> {
    try {
      // Get system stats
      const { stdout: vmstat } = await exec('vmstat', ['1', '2']);
      const lines = vmstat.split('\n');
      const cpuLine = lines[lines.length - 1].trim().split(/\s+/);
      const cpuIdle = parseInt(cpuLine[15] || '0', 10);
      const cpu = 100 - cpuIdle;

      // Memory from /proc/meminfo
      const { stdout: meminfo } = await exec('cat', ['/proc/meminfo']);
      const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0', 10);
      const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0', 10);
      const memory = ((memTotal - memAvailable) / memTotal) * 100;

      // Disk usage
      const { stdout: df } = await exec('df', ['/']);
      const dfLines = df.split('\n');
      const dfLine = dfLines[dfLines.length - 1].split(/\s+/);
      const disk = parseInt(dfLine[dfLine.length - 2] || '0', 10);

      return {
        cpu,
        memory,
        disk,
        connectedClients: await this.getConnectedClientCount(),
      };
    } catch (error) {
      console.error('Failed to get details:', error);
      return {};
    }
  }

  /**
   * Create a new VPN client
   */
  async createClient(name: string): Promise<CreateClientResult> {
    // Validate client name
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error(`Invalid client name: ${name}`);
    }

    // Run the add-user script
    try {
      const { stdout, stderr } = await exec(
        path.join(ADMIN_DIR, 'add-user.sh'),
        [name],
        { timeout: 60000 }
      );

      // Read the generated .ovpn file
      const ovpnPath = path.join(ADMIN_DIR, 'clients', `${name}.ovpn`);
      const { stdout: ovpnContent } = await exec('cat', [ovpnPath]);

      // Get fingerprint from certificate
      const certPath = path.join(OVPN_DIR, 'easy-rsa', 'pki', 'issued', `${name}.crt`);
      const { stdout: certInfo } = await exec(
        'openssl',
        ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256']
      );
      const fingerprint = certInfo.split('=')[1]?.trim() || '';

      return {
        success: true,
        client: {
          name,
          fingerprint,
          ovpnContent: Buffer.from(ovpnContent).toString('base64'),
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      console.error('Failed to create client:', error);
      throw new Error(`Client creation failed: ${error.message}`);
    }
  }

  /**
   * Revoke a VPN client
   */
  async revokeClient(name: string): Promise<{ success: true }> {
    try {
      // Run revoke script
      await exec(
        path.join(ADMIN_DIR, 'revoke-user.sh'),
        [name],
        { timeout: 60000 }
      );

      // CRITICAL: Reload OpenVPN to apply CRL immediately
      // Otherwise revoked certificates may continue working
      try {
        await exec('systemctl', ['reload', 'openvpn-xor'], { timeout: 10000 });
        console.log(`  ✓ OpenVPN reloaded - CRL applied for ${name}`);
      } catch (reloadError) {
        // Fallback to SIGHUP if systemctl reload fails
        try {
          await exec('killall', ['-HUP', 'openvpn'], { timeout: 5000 });
          console.log(`  ✓ OpenVPN SIGHUP sent - CRL applied for ${name}`);
        } catch (hupError) {
          console.warn(`  ⚠ Warning: Could not reload OpenVPN CRL`);
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error('Failed to revoke client:', error);
      throw new Error(`Client revocation failed: ${error.message}`);
    }
  }

  /**
   * List all clients
   */
  async listClients(): Promise<Array<{ name: string; status: string; fingerprint: string }>> {
    try {
      const { stdout } = await exec(path.join(ADMIN_DIR, 'list-users.sh'));

      // Parse output
      const lines = stdout.split('\n');
      const clients: Array<{ name: string; status: string; fingerprint: string }> = [];

      for (const line of lines) {
        const match = line.match(/✓\s+(.+)$/);
        if (match) {
          const name = match[1];

          // Get fingerprint
          try {
            const certPath = path.join(OVPN_DIR, 'easy-rsa', 'pki', 'issued', `${name}.crt`);
            const { stdout: certInfo } = await exec(
              'openssl',
              ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256']
            );
            const fingerprint = certInfo.split('=')[1]?.trim() || '';

            clients.push({ name, status: 'ACTIVE', fingerprint });
          } catch {
            // Certificate might be revoked
          }
        }
      }

      return clients;
    } catch (error) {
      console.error('Failed to list clients:', error);
      return [];
    }
  }

  /**
   * Sync clients list
   */
  async sync(): Promise<{ success: true; clients: any[] }> {
    const clients = await this.listClients();
    return { success: true, clients };
  }

  /**
   * Get client config file
   */
  async getClientConfig(name: string): Promise<{ success: true; ovpnContent: string }> {
    const ovpnPath = path.join(ADMIN_DIR, 'clients', `${name}.ovpn`);
    const { stdout } = await exec('cat', [ovpnPath]);

    return {
      success: true,
      ovpnContent: Buffer.from(stdout).toString('base64'),
    };
  }

  /**
   * Get number of connected clients from status file
   */
  private async getConnectedClientCount(): Promise<number> {
    try {
      const { stdout } = await exec('cat', ['/var/log/openvpn-xor-status.log']);
      const match = stdout.match(/n_clients=(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if OpenVPN is already installed and return installation info
   */
  async checkInstallation(): Promise<{
    installed: boolean;
    version?: string;
    xorMask?: string;
    binaryExists: boolean;
    configExists: boolean;
    pkiExists: boolean;
  }> {
    const result: {
      installed: boolean;
      binaryExists: boolean;
      configExists: boolean;
      pkiExists: boolean;
      version?: string;
      xorMask?: string;
    } = {
      installed: false,
      binaryExists: false,
      configExists: false,
      pkiExists: false,
    };

    try {
      // Check if binary exists
      await exec('test', ['-f', OVPN_BIN]);
      result.binaryExists = true;

      // Get version
      try {
        const { stdout: versionOutput } = await exec(OVPN_BIN, ['--version']);
        const versionMatch = versionOutput.match(/OpenVPN (\d+\.\d+\.\d+)/);
        if (versionMatch?.[1]) {
          result.version = versionMatch[1];
        }
      } catch {
        // Version check failed
      }

      // Check if config exists
      try {
        await exec('test', ['-f', `${OVPN_DIR}/server.conf`]);
        result.configExists = true;

        // Get XOR mask from config
        const { stdout: configOutput } = await exec('cat', [`${OVPN_DIR}/server.conf`]);
        const xorMatch = configOutput.match(/scramble xormask (\S+)/);
        if (xorMatch?.[1]) {
          result.xorMask = xorMatch[1];
        }
      } catch {
        // Config doesn't exist
      }

      // Check if PKI exists
      try {
        await exec('test', ['-f', `${OVPN_DIR}/easy-rsa/pki/ca.crt`]);
        result.pkiExists = true;
      } catch {
        // PKI doesn't exist
      }

      result.installed = result.binaryExists && result.configExists && result.pkiExists;
    } catch {
      // OpenVPN not installed
    }

    return result;
  }
}
