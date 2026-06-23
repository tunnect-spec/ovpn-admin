import axios, { AxiosInstance } from 'axios';
import { IntervalScheduler } from './scheduler';
import { OpenVpnOps } from './ops';
import { VERSION } from './config';

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

// Number of CONSECUTIVE 401 (auth) failures tolerated before we treat the token
// as permanently invalid and exit. A single transient 401 must not kill the
// agent.
const MAX_CONSECUTIVE_AUTH_FAILURES = 5;

// Durable completion reporting: number of attempts and base backoff.
const REPORT_MAX_ATTEMPTS = 5;
const REPORT_BASE_DELAY_MS = 1000;

export class Agent {
  private api: AxiosInstance;
  private ops: OpenVpnOps;
  private scheduler: IntervalScheduler;
  private stopping = false;
  private heartbeatCount = 0;
  private consecutiveAuthFailures = 0;
  // Resolves when the current job batch / heartbeat body has finished, so a
  // graceful stop can drain in-flight cert ops before exiting.
  private inFlightWork: Promise<void> | null = null;

  constructor(private config: AgentConfig) {
    this.api = axios.create({
      baseURL: config.panelUrl,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'User-Agent': `ovpn-agent/${VERSION}`,
      },
      timeout: 30000,
    });

    this.ops = new OpenVpnOps();
    this.scheduler = new IntervalScheduler(config.heartbeatInterval * 1000);
  }

  async start() {
    console.log(`Starting OpenVPN XOR Agent v${VERSION}...`);

    // Start heartbeat loop. The scheduler is self-scheduling and never overlaps
    // invocations, so heartbeats can't pile up if the panel is slow.
    this.scheduler.start(() => this.heartbeat());
  }

  async stop() {
    if (this.stopping) return;
    console.log('Stopping agent...');

    // 1. Signal intent so no new heartbeat/job work starts.
    this.stopping = true;

    // 2. Cancel the scheduler so no further ticks fire.
    this.scheduler.stop();

    // 3. Drain: wait for any in-flight heartbeat/job (a cert op may be running)
    //    to finish before we exit. Never process.exit mid-flight.
    try {
      await this.scheduler.drain();
      if (this.inFlightWork) {
        await this.inFlightWork;
      }
    } catch (err) {
      console.error('Error while draining in-flight work during stop:', err);
    }

    console.log('Agent stopped cleanly.');
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

      // Any successful heartbeat clears the consecutive-auth-failure counter.
      this.consecutiveAuthFailures = 0;
      const duration = Date.now() - startTime;

      console.log(`[✓] Heartbeat #${this.heartbeatCount} (${duration}ms) - Clients: ${status.connectedClients || 0}`);

      // Process pending jobs. Track the batch as in-flight work so a graceful
      // stop drains it instead of exiting mid cert op.
      const jobs: Job[] = response.data?.pendingJobs || [];
      if (jobs.length > 0) {
        console.log(`  → ${jobs.length} pending job(s)`);
        const batch = (async () => {
          for (const job of jobs) {
            if (this.stopping) break;
            await this.processJob(job);
          }
        })();
        this.inFlightWork = batch;
        try {
          await batch;
        } finally {
          this.inFlightWork = null;
        }
      }
    } catch (error: any) {
      this.handleHeartbeatError(error);
    }
  }

  /**
   * Classify a heartbeat error. Policy:
   *  - 401: count consecutive occurrences; exit only after N in a row.
   *  - 404: never exit (node may not be registered yet / transient panel state).
   *  - network / other: never exit; just log and let the scheduler back off.
   * Any later success resets the auth-failure counter.
   */
  private handleHeartbeatError(error: any): void {
    if (error?.response) {
      const statusCode = error.response.status;

      if (statusCode === 401) {
        this.consecutiveAuthFailures++;
        console.error(
          `[✗] Authentication failed (401) - attempt ${this.consecutiveAuthFailures}/${MAX_CONSECUTIVE_AUTH_FAILURES}`
        );
        if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
          console.error(
            `[✗] ${MAX_CONSECUTIVE_AUTH_FAILURES} consecutive auth failures - API token appears invalid. Exiting.`
          );
          process.exit(1);
        }
        return;
      }

      if (statusCode === 404) {
        // Do NOT exit on 404 - the node may simply not be registered yet, or the
        // panel is in a transient state. Back off and retry on the next tick.
        console.error('[✗] Node not found on panel (404) - will retry');
        return;
      }

      console.error(`[✗] Heartbeat failed: HTTP ${statusCode} - will retry`);
      return;
    }

    if (error?.request) {
      // Network error: panel unreachable. Never exit; the scheduler will retry.
      console.error('[✗] Panel unreachable (network error) - will retry');
      return;
    }

    console.error('[✗] Heartbeat error:', error?.message ?? error);
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

  /**
   * Durable completion reporting. The panel MUST learn the outcome of a job, so
   * a single transient POST failure can't be swallowed. Retry with exponential
   * backoff (1s, 2s, 4s, ...). After all attempts are exhausted we log clearly
   * and give up without crashing the agent.
   */
  private async reportJobCompletion(
    jobId: string,
    success: boolean,
    result?: any,
    error?: string
  ): Promise<void> {
    const body = { success, result, error };

    for (let attempt = 1; attempt <= REPORT_MAX_ATTEMPTS; attempt++) {
      try {
        await this.api.post(`/api/agent/jobs/${jobId}/complete`, body);
        if (attempt > 1) {
          console.log(`  ✓ Reported completion for job ${jobId} (attempt ${attempt})`);
        }
        return;
      } catch (err: any) {
        const reason = err?.response
          ? `HTTP ${err.response.status}`
          : err?.message ?? 'unknown error';

        if (attempt === REPORT_MAX_ATTEMPTS) {
          console.error(
            `  ✗ Failed to report completion for job ${jobId} after ${REPORT_MAX_ATTEMPTS} attempts (${reason}) - giving up`
          );
          return;
        }

        const delay = REPORT_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `  ⚠ Failed to report completion for job ${jobId} (attempt ${attempt}/${REPORT_MAX_ATTEMPTS}, ${reason}) - retrying in ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
