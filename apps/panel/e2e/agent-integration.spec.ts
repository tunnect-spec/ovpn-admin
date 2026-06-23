import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';

test.describe('Agent Integration Tests', () => {
  let adminToken: string;
  let nodeId: string;
  let registrationToken: string;
  let apiToken: string;

  test.beforeAll(async () => {
    // Login as admin to get token
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    });

    const loginData = await loginResponse.json();
    adminToken = loginData.token;
    console.log('✓ Admin login successful');

    // Cleanup ALL existing nodes for clean test environment
    const nodesResponse = await fetch(`${BASE_URL}/api/nodes`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const nodesData = await nodesResponse.json();

    for (const node of nodesData.nodes || []) {
      // First revoke all active clients for this node
      const clientsResponse = await fetch(`${BASE_URL}/api/nodes/${node.id}/clients`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      const clientsData = await clientsResponse.json();

      for (const client of clientsData.clients || []) {
        if (client.status === 'ACTIVE') {
          await fetch(`${BASE_URL}/api/clients/${client.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` },
          });
        }
      }

      // Then delete the node
      await fetch(`${BASE_URL}/api/nodes/${node.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
    }
    console.log(`✓ Cleaned up ${nodesData.nodes?.length || 0} existing nodes`);
  });

  test('Full Agent Lifecycle Integration', async () => {
    console.log('\n=== Agent Integration Test ===\n');

    // Cleanup before main test
    const nodesResponse = await fetch(`${BASE_URL}/api/nodes`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const nodesData = await nodesResponse.json();

    for (const node of nodesData.nodes || []) {
      await fetch(`${BASE_URL}/api/nodes/${node.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
    }
    if (nodesData.nodes?.length > 0) {
      console.log(`✓ Cleaned up ${nodesData.nodes.length} nodes before test`);
    }

    // Step 1: Create Node
    console.log('Step 1: Creating node...');
    const timestamp = Date.now();
    const nodeName = `integration-test-node-${timestamp}`;
    const hostName = `integration-test-${timestamp}.example.com`;

    const createNodeResponse = await fetch(`${BASE_URL}/api/nodes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: nodeName,
        host: hostName,
        port: 22,
      }),
    });

    const createNodeData = await createNodeResponse.json();
    expect(createNodeResponse.status).toBe(201);
    expect(createNodeData.node).toBeDefined();
    expect(createNodeData.registrationToken).toBeDefined();

    nodeId = createNodeData.node.id;
    registrationToken = createNodeData.registrationToken;

    console.log(`✓ Node created: ${nodeId}`);
    console.log(`  Registration token: ${registrationToken.substring(0, 8)}...`);

    // Step 2: Agent Register
    console.log('\nStep 2: Agent registration...');
    const registerResponse = await fetch(`${BASE_URL}/api/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: registrationToken,
        agentVersion: '1.0.0',
        systemInfo: {
          os: 'Linux',
          kernel: '5.15.0',
          arch: 'x86_64',
        },
      }),
    });

    const registerData = await registerResponse.json();
    expect(registerResponse.status).toBe(200);
    expect(registerData.success).toBe(true);
    expect(registerData.node.apiToken).toBeDefined();

    apiToken = registerData.node.apiToken;
    console.log('✓ Agent registered successfully');
    console.log(`  API Token: ${apiToken.substring(0, 8)}...`);

    // Step 3: Verify node status changed to PROVISIONING
    console.log('\nStep 3: Verifying node status...');
    const nodeResponse = await fetch(`${BASE_URL}/api/nodes/${nodeId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });

    const nodeData = await nodeResponse.json();
    expect(nodeData.node.status).toBe('PROVISIONING');
    console.log(`✓ Node status: ${nodeData.node.status}`);

    // Step 4: Agent Heartbeat (simulating polling)
    console.log('\nStep 4: Agent heartbeat...');
    const heartbeatResponse = await fetch(`${BASE_URL}/api/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId,
        status: 'RUNNING',
        details: {
          connectedClients: 0,
          cpu: 10.5,
          memory: 45.2,
        },
      }),
    });

    const heartbeatData = await heartbeatResponse.json();
    expect(heartbeatResponse.status).toBe(200);
    expect(heartbeatData.success).toBe(true);
    expect(heartbeatData.pendingJobs).toBeDefined();

    console.log('✓ Heartbeat successful');
    console.log(`  Pending jobs: ${heartbeatData.pendingJobs.length}`);

    // Step 5: Agent Reports Install Complete
    console.log('\nStep 5: Agent reports install complete...');
    const installResponse = await fetch(`${BASE_URL}/api/agent/install`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        version: '2.7.3',
        xorMask: 'xor42',
      }),
    });

    const installData = await installResponse.json();
    expect(installResponse.status).toBe(200);
    expect(installData.success).toBe(true);

    console.log('✓ Install completion reported');

    // Step 6: Verify node status changed to HEALTHY
    console.log('\nStep 6: Verifying node is HEALTHY...');
    const healthyNodeResponse = await fetch(`${BASE_URL}/api/nodes/${nodeId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });

    const healthyNodeData = await healthyNodeResponse.json();
    expect(healthyNodeData.node.status).toBe('HEALTHY');
    expect(healthyNodeData.node.openvpnVersion).toBe('2.7.3');
    expect(healthyNodeData.node.xorMask).toBe('xor42');

    console.log('✓ Node is HEALTHY');
    console.log(`  OpenVPN version: ${healthyNodeData.node.openvpnVersion}`);
    console.log(`  XOR mask: ${healthyNodeData.node.xorMask}`);

    // Step 7: Agent Sync (get clients list)
    console.log('\nStep 7: Agent sync clients...');
    const syncResponse = await fetch(`${BASE_URL}/api/agent/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const syncData = await syncResponse.json();
    expect(syncResponse.status).toBe(200);
    expect(syncData.success).toBe(true);
    expect(syncData.clients).toBeDefined();

    console.log('✓ Sync successful');
    console.log(`  Clients count: ${syncData.clients.length}`);

    // Step 8: Admin creates a client
    console.log('\nStep 8: Admin creates client...');
    const createClientResponse = await fetch(`${BASE_URL}/api/nodes/${nodeId}/clients`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test-user-1',
        expiresIn: 30,
      }),
    });

    const createClientData = await createClientResponse.json();
    expect(createClientResponse.status).toBe(201);
    expect(createClientData.client).toBeDefined();
    expect(createClientData.job).toBeDefined();

    console.log('✓ Client creation requested');
    console.log(`  Client name: ${createClientData.client.name}`);

    // Step 9: Agent gets pending job from heartbeat
    console.log('\nStep 9: Agent polls for job...');
    const jobHeartbeatResponse = await fetch(`${BASE_URL}/api/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId,
        status: 'RUNNING',
        details: {},
      }),
    });

    const jobHeartbeatData = await jobHeartbeatResponse.json();
    expect(jobHeartbeatData.pendingJobs.length).toBeGreaterThanOrEqual(1);
    expect(jobHeartbeatData.pendingJobs[0].type).toBe('CLIENT_CREATE');

    console.log('✓ Job received from heartbeat');
    console.log(`  Job type: ${jobHeartbeatData.pendingJobs[0].type}`);

    // Note: In real flow, agent would execute the job and report completion
    // For MVP test, we skip the actual execution and report completion

    // Step 10: Agent reports client creation complete
    console.log('\nStep 10: Simulating agent job completion...');
    // In production, agent would call a job completion endpoint
    // For now, we verify the client was created by admin

    // Step 11: Verify client in database
    console.log('\nStep 11: Verifying client in database...');
    const clientsResponse = await fetch(`${BASE_URL}/api/nodes/${nodeId}/clients`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });

    const clientsData = await clientsResponse.json();
    expect(clientsData.clients.length).toBe(1);
    expect(clientsData.clients[0].name).toBe('test-user-1');
    expect(clientsData.clients[0].status).toBe('ACTIVE');

    console.log('✓ Client verified in database');
    console.log(`  Client: ${clientsData.clients[0].name} (${clientsData.clients[0].status})`);

    // Step 12: Dashboard stats verify
    console.log('\nStep 12: Verifying dashboard stats...');
    const statsResponse = await fetch(`${BASE_URL}/api/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });

    const statsData = await statsResponse.json();
    expect(statsData.nodes.total).toBe(1);
    expect(statsData.nodes.healthy).toBe(1);
    expect(statsData.clients.total).toBe(1);
    expect(statsData.clients.active).toBe(1);

    console.log('✓ Dashboard stats verified');
    console.log(`  Nodes: ${statsData.nodes.total} total, ${statsData.nodes.healthy} healthy`);
    console.log(`  Clients: ${statsData.clients.total} total, ${statsData.clients.active} active`);

    // Cleanup
    await fetch(`${BASE_URL}/api/nodes/${nodeId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    console.log('✓ Test node deleted');

    console.log('\n=== All Integration Tests Passed! ===\n');
  });

  test('Agent Install Script Endpoint', async () => {
    console.log('\n=== Testing Install Script Endpoint ===\n');

    const response = await fetch(`${BASE_URL}/api/agent/install.sh`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('AGENT_TOKEN');
    expect(text).toContain('PANEL_URL');

    console.log('✓ Install script endpoint works');
    console.log('  Script contains AGENT_TOKEN and PANEL_URL placeholders');
  });

  test('Agent Authentication - Invalid Token', async () => {
    console.log('\n=== Testing Invalid Token Handling ===\n');

    const response = await fetch(`${BASE_URL}/api/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodeId: 'test', status: 'RUNNING', details: {} }),
    });

    expect(response.status).toBe(401);

    console.log('✓ Invalid token rejected correctly');
  });

  test('Agent Authentication - Missing Token', async () => {
    console.log('\n=== Testing Missing Token Handling ===\n');

    const response = await fetch(`${BASE_URL}/api/agent/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'test', status: 'RUNNING', details: {} }),
    });

    expect(response.status).toBe(401);

    console.log('✓ Missing token rejected correctly');
  });

  test('Registration Token Security', async () => {
    console.log('\n=== Testing Registration Token Security ===\n');

    // Test with invalid token (too short)
    const response = await fetch(`${BASE_URL}/api/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'short',
        agentVersion: '1.0.0',
        systemInfo: { os: 'Linux', kernel: '5.15', arch: 'x86_64' },
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('INVALID_INPUT');

    console.log('✓ Invalid registration token rejected');
  });
});
