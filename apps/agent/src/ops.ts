import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

const exec = promisify(execFile);

// OpenVPN status file (status-version 2) and the per-client cumulative-traffic
// accumulator directory written by the client-disconnect hook.
const STATUS_FILE = '/var/log/openvpn-xor-status.log';
const TRAFFIC_DIR = '/etc/openvpn/xor/traffic';

export interface ClientTraffic {
  name: string;
  bytesUp: number;   // client upload   (server "Bytes Received")
  bytesDown: number; // client download (server "Bytes Sent")
  online: boolean;
}

// Client names are interpolated into root-run shell scripts (add-user.sh /
// revoke-user.sh) and into filesystem paths. Validate every name at every entry
// point — not just on create — to prevent argument/path injection.
const CLIENT_NAME_RE = /^[a-zA-Z0-9._-]+$/;
function assertValidClientName(name: string): void {
  if (!name || !CLIENT_NAME_RE.test(name) || name.length > 64) {
    throw new Error(`Invalid client name: ${name}`);
  }
}

// Paths from the install script
const OVPN_DIR = '/etc/openvpn/xor';
const ADMIN_DIR = '/root/ovpn-xor-admin';
// The XOR installer symlinks the patched binary as `openvpn-xor`. Prefer that,
// falling back to a plain `openvpn` for other layouts.
const OVPN_BIN = existsSync('/usr/local/sbin/openvpn-xor')
  ? '/usr/local/sbin/openvpn-xor'
  : '/usr/local/sbin/openvpn';

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

      // Get OpenVPN version. Report 'unknown' rather than a fabricated default
      // when the real version can't be read.
      let version = 'unknown';
      try {
        const { stdout: versionOutput } = await exec(OVPN_BIN, ['--version']);
        const versionMatch = versionOutput.match(/OpenVPN (\d+\.\d+\.\d+)/);
        if (versionMatch?.[1]) {
          version = versionMatch[1];
        }
      } catch (e) {
        // Real version unavailable; leave as 'unknown'.
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
      // CPU from two /proc/stat samples (reliable across kernels/locales, unlike
      // a fixed vmstat column index which mis-parsed to ~100% on some hosts).
      const cpu = await this.getCpuUsage();

      // Memory from /proc/meminfo. Guard against memTotal === 0 so we never
      // divide by zero and emit NaN to the panel.
      const { stdout: meminfo } = await exec('cat', ['/proc/meminfo']);
      const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0', 10);
      const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0', 10);
      const memory = memTotal > 0 ? ((memTotal - memAvailable) / memTotal) * 100 : 0;

      // Disk usage. Use `df --output=pcent /` which prints a header line and a
      // single trailing percentage (e.g. "42%"), then strip the '%'. This is
      // robust against column-count differences; fall back to 0 if unparseable.
      let disk = 0;
      try {
        const { stdout: dfOut } = await exec('df', ['--output=pcent', '/']);
        const pctMatch = dfOut.match(/(\d+)\s*%/);
        if (pctMatch?.[1]) {
          const parsed = parseInt(pctMatch[1], 10);
          if (!Number.isNaN(parsed)) {
            disk = parsed;
          }
        }
      } catch {
        // df unavailable or unexpected output; leave disk at 0.
      }

      return {
        cpu: Number.isNaN(cpu) ? 0 : cpu,
        memory: Number.isNaN(memory) ? 0 : memory,
        disk,
        connectedClients: await this.getConnectedClientCount(),
      };
    } catch (error) {
      console.error('Failed to get details:', error);
      return {};
    }
  }

  /**
   * CPU usage percentage from two /proc/stat snapshots. Computes the non-idle
   * fraction of the jiffy delta over a short window — robust to kernel/column
   * differences (the previous vmstat-index approach reported ~100% on 1-core
   * hosts).
   */
  private async getCpuUsage(): Promise<number> {
    const sample = async (): Promise<{ idle: number; total: number }> => {
      const { stdout } = await exec('cat', ['/proc/stat']);
      const cpuLine = stdout.split('\n').find((l) => l.startsWith('cpu '));
      const parts = (cpuLine || '').trim().split(/\s+/).slice(1).map((n) => parseInt(n, 10) || 0);
      const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const a = await sample();
    await new Promise((r) => setTimeout(r, 250));
    const b = await sample();
    const dTotal = b.total - a.total;
    const dIdle = b.idle - a.idle;
    if (dTotal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 100)));
  }

  /**
   * Create a new VPN client
   */
  async createClient(name: string): Promise<CreateClientResult> {
    assertValidClientName(name);

    const certPath = path.join(OVPN_DIR, 'easy-rsa', 'pki', 'issued', `${name}.crt`);
    const ovpnPath = path.join(ADMIN_DIR, 'clients', `${name}.ovpn`);

    try {
      // Idempotency: if the client already exists on disk (issued cert OR the
      // generated .ovpn), do NOT re-run add-user.sh. Duplicate job delivery is
      // then safe — we simply read back and return the existing artifacts.
      if (existsSync(certPath) || existsSync(ovpnPath)) {
        console.log(`  ↺ Client "${name}" already exists - returning existing config (idempotent)`);
        return await this.buildClientResult(name, ovpnPath, certPath);
      }

      // Run the add-user script to create the client.
      await exec(
        path.join(ADMIN_DIR, 'add-user.sh'),
        [name],
        { timeout: 60000 }
      );

      return await this.buildClientResult(name, ovpnPath, certPath);
    } catch (error: any) {
      console.error('Failed to create client:', error);
      throw new Error(`Client creation failed: ${error.message}`);
    }
  }

  /**
   * Read the generated .ovpn config and certificate fingerprint for an existing
   * client and assemble the success result. Shared by the create path and the
   * idempotent already-exists path so both return the identical shape.
   */
  private async buildClientResult(
    name: string,
    ovpnPath: string,
    certPath: string
  ): Promise<CreateClientResult> {
    // Read the generated .ovpn file
    const { stdout: ovpnContent } = await exec('cat', [ovpnPath]);

    // Get fingerprint from certificate
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
  }

  /**
   * Revoke a VPN client
   */
  async revokeClient(name: string): Promise<{ success: true }> {
    assertValidClientName(name);
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
          const name = match[1].trim();
          // Skip anything that isn't a well-formed client name before using it
          // to build a filesystem path.
          if (!CLIENT_NAME_RE.test(name)) continue;

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
    assertValidClientName(name);
    const ovpnPath = path.join(ADMIN_DIR, 'clients', `${name}.ovpn`);
    const { stdout } = await exec('cat', [ovpnPath]);

    return {
      success: true,
      ovpnContent: Buffer.from(stdout).toString('base64'),
    };
  }

  /**
   * Read the OpenVPN status file (status-version 2). Returns '' if unavailable.
   */
  private async readStatusFile(): Promise<string> {
    try {
      const { stdout } = await exec('cat', [STATUS_FILE]);
      return stdout;
    } catch {
      return '';
    }
  }

  /**
   * Parse the current (live) session bytes per Common Name from a status-version 2
   * file. CLIENT_LIST rows are: CLIENT_LIST,<CN>,<real>,<vaddr>,<vaddr6>,<bytesRecv>,<bytesSent>,...
   */
  private parseSessions(status: string): Map<string, { up: number; down: number }> {
    const sessions = new Map<string, { up: number; down: number }>();
    for (const line of status.split('\n')) {
      const p = line.split(',');
      if (p[0] === 'CLIENT_LIST' && p[1] && CLIENT_NAME_RE.test(p[1])) {
        sessions.set(p[1], {
          up: parseInt(p[5] || '0', 10) || 0,   // server received = client upload
          down: parseInt(p[6] || '0', 10) || 0, // server sent     = client download
        });
      }
    }
    return sessions;
  }

  /**
   * Read cumulative totals from completed sessions (written by client-disconnect).
   * Each file is named after the Common Name and contains "<up> <down>".
   */
  private readAccumulator(): Map<string, { up: number; down: number }> {
    const totals = new Map<string, { up: number; down: number }>();
    try {
      if (!existsSync(TRAFFIC_DIR)) return totals;
      for (const name of readdirSync(TRAFFIC_DIR)) {
        if (!CLIENT_NAME_RE.test(name)) continue;
        try {
          const [up, down] = readFileSync(path.join(TRAFFIC_DIR, name), 'utf-8')
            .trim()
            .split(/\s+/)
            .map((n) => parseInt(n, 10) || 0);
          totals.set(name, { up: up || 0, down: down || 0 });
        } catch {
          /* skip unreadable entry */
        }
      }
    } catch {
      /* traffic dir not present yet */
    }
    return totals;
  }

  private async getConnectedClientCount(): Promise<number> {
    return this.parseSessions(await this.readStatusFile()).size;
  }

  /**
   * Cumulative per-client traffic = completed-session totals (accumulator) plus
   * the bytes of the current live session (if connected). Stable across
   * reconnects because a disconnect moves the live bytes into the accumulator.
   */
  async getClientTraffic(): Promise<ClientTraffic[]> {
    const sessions = this.parseSessions(await this.readStatusFile());
    const totals = this.readAccumulator();
    const names = new Set<string>([...sessions.keys(), ...totals.keys()]);
    const result: ClientTraffic[] = [];
    for (const name of names) {
      const acc = totals.get(name) ?? { up: 0, down: 0 };
      const live = sessions.get(name);
      result.push({
        name,
        bytesUp: acc.up + (live?.up ?? 0),
        bytesDown: acc.down + (live?.down ?? 0),
        online: !!live,
      });
    }
    return result;
  }

  /**
   * Run the OpenVPN XOR installer with the options chosen in the panel
   * (XOR on/off, DNS mode, domain, MTU/MSSFIX). The installer is idempotent:
   * on an already-installed node it only regenerates config + restarts (fast,
   * PKI preserved); on a fresh node it builds from source (several minutes).
   */
  async installOpenVpn(payload: any = {}): Promise<{ installed: boolean; version?: string; xorMask?: string }> {
    const candidates = [
      '/opt/ovpn-admin-src/install-openvpn-xor.sh',
      '/opt/ovpn-agent/install-openvpn-xor.sh',
    ];
    const installer = candidates.find((p) => existsSync(p));
    if (!installer) {
      throw new Error('OpenVPN installer script not found on this node');
    }

    const env = {
      ...process.env,
      SERVER_HOST: payload.serverHost ? String(payload.serverHost) : '',
      PORT: String(payload.port ?? 443),
      PROTO: String(payload.protocol ?? 'udp'),
      USE_XOR: payload.useXor === false ? '0' : '1',
      DNS_MODE: String(payload.dnsMode ?? 'standard'),
      CUSTOM_DNS: payload.customDns ? String(payload.customDns) : '',
      DOMAIN: payload.domain ? String(payload.domain) : '',
      MTU: String(payload.mtu ?? 1500),
      MSSFIX: String(payload.mssfix ?? 1360),
      FIRST_USER: payload.firstUser ? String(payload.firstUser) : 'client1',
    };

    // Up to 45 min to allow a from-source compile on the first install.
    await exec('bash', [installer], { env, timeout: 45 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });

    const info = await this.checkInstallation();
    return { installed: info.installed, version: info.version, xorMask: info.xorMask };
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
