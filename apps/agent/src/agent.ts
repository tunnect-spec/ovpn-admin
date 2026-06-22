import axios, { AxiosInstance } from 'axios';
import { IntervalScheduler } from './scheduler';
import { OpenVpnOps, CreateClientResult } from './ops';

export interface AgentConfig {
  panelUrl: string;
  token: string;
  heartbeatInterval: number;
}

export interface Job {
  id: string;
  type: string;
  payload?: any;
}

export class Agent {
  private api: AxiosInstance;
  private ops: OpenVpnOps;
  private scheduler: IntervalScheduler;
  private nodeId?: string;
  private stopping = false;
  private heartbeatCount = 0;
  private successCount = 0;

  constructor(private config: AgentConfig) {
    this.api = axios.create({
      baseURL: config.panelUrl,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'User-Agent': `ovpn-agent/3.1.0`,
      },
      timeout: 30000,
    });

    this.ops = new OpenVpnOps();
    this.scheduler = new IntervalScheduler(config.heartbeatInterval * 1000);
  }

  async start() {
    console.log('Starting OpenVPN XOR Agent v2.2.0...');

    // Start heartbeat loop
    this.scheduler.start(() => this.heartbeat());
  }

  async stop() {
    console.log('Stopping agent...');
    this.stopping = true;
    this.scheduler.stop();
    process.exit(0);
  }

  private async heartbeat() {
    if (this.stopping) return;

    this.heartbeatCount++;
    const startTime = Date.now();

    try {
      // Get OpenVPN status
      const status = await this.ops.getStatus();
      const details = await this.ops.getDetails();

      // Send heartbeat to panel
      const response = await this.api.post('/api/agent/heartbeat', {
        timestamp: startTime,
        uptime: Math.floor(process.uptime()),
        status: status.openvpn === 'RUNNING' ? 'RUNNING' : 'ERROR',
        details: {
          connectedClients: status.connectedClients || 0,
          cpu: details.cpu || 0,
          memory: details.memory || 0,
          disk: details.disk || 0,
          uptime: details.uptime || 0,
        },
      });

      this.successCount++;
      const duration = Date.now() - startTime;

      console.log(`[✓] Heartbeat #${this.heartbeatCount} (${duration}ms) - Clients: ${status.connectedClients || 0}`);

      // Process pending jobs
      const jobs = response.data?.pendingJobs || [];
      if (jobs.length > 0) {
        console.log(`  → ${jobs.length} pending job(s)`);
        for (const job of jobs) {
          await this.processJob(job);
        }
      }
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401) {
          console.error('[✗] Authentication failed - API token invalid');
          process.exit(1);
        }
        if (error.response.status === 404) {
          console.error('[✗] Node not found on panel');
          process.exit(1);
        }
        console.error(`[✗] Heartbeat failed: HTTP ${error.response.status}`);
      } else if (error.request) {
        console.error('[✗] Panel unreachable');
      } else {
        console.error('[✗] Heartbeat error:', error.message);
      }
    }
  }

  private async processJob(job: Job) {
    console.log(`  Processing: ${job.type}`);

    try {
      let result;

      switch (job.type) {
        case 'CLIENT_CREATE':
        case 'client-create':
          result = await this.ops.createClient(job.payload?.clientName || job.payload?.name);
          break;

        case 'CLIENT_REVOKE':
        case 'client-revoke':
          result = await this.ops.revokeClient(job.payload?.clientName || job.payload?.name);
          break;

        case 'NODE_SYNC':
        case 'node-sync':
          result = await this.ops.sync();
          break;

        case 'NODE_INSTALL':
        case 'node-install':
          // Check installation status and return real data
          const installInfo = await this.ops.checkInstallation();
          result = {
            installed: installInfo.installed,
            version: installInfo.version,
            xorMask: installInfo.xorMask,
            binaryExists: installInfo.binaryExists,
            configExists: installInfo.configExists,
            pkiExists: installInfo.pkiExists,
          };
          break;

        default:
          console.warn(`  Unknown job type: ${job.type}`);
          return;
      }

      // Report job completion to panel
      await this.reportJobCompletion(job.id, true, result);
      console.log(`  ✓ Job ${job.id} completed`);
    } catch (error: any) {
      console.error(`  ✗ Job ${job.id} failed:`, error.message);
      // Report job failure to panel
      await this.reportJobCompletion(job.id, false, null, error.message);
    }
  }

  private async reportJobCompletion(
    jobId: string,
    success: boolean,
    result?: any,
    error?: string
  ) {
    try {
      await this.api.post(`/api/agent/jobs/${jobId}/complete`, {
        success,
        result,
        error,
      });
    } catch (err) {
      console.error(`  Failed to report job completion:`, err);
    }
  }
}
