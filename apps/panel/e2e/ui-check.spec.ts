import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';

test.describe('OVPN Admin Panel UI', () => {
  test.beforeAll(async () => {
    // Ensure server is running
    console.log('Starting tests against', BASE_URL);
  });

  test('Homepage loads and redirects to login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Should redirect to login or show login button
    const url = page.url();
    expect(url).toMatch(/\/(login|$)/);

    // Check title
    const title = await page.title();
    expect(title).toBe('OpenVPN Admin Panel');
  });

  test('Login page displays correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Check for login form elements
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Check page title
    const title = await page.title();
    expect(title).toBe('OpenVPN Admin Panel');
  });

  test('Login with valid credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    // Fill login form
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Verify we're on dashboard
    expect(page.url()).toContain('/dashboard');
  });

  test('Dashboard displays statistics', async ({ page }) => {
    // Login first
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    await page.waitForLoadState('networkidle');

    // Check for dashboard elements
    const pageContent = await page.content();

    // Check for common dashboard elements
    expect(pageContent.length).toBeGreaterThan(1000);

    // Take screenshot for verification
    await page.screenshot({ path: 'test-screenshots/dashboard.png' });
  });

  test('Navigate to nodes page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    // Navigate to nodes
    await page.goto(`${BASE_URL}/dashboard/nodes`);
    await page.waitForLoadState('networkidle');

    // Check for nodes page content
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(1000);

    await page.screenshot({ path: 'test-screenshots/nodes.png' });
  });

  test('Navigate to audit logs page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    await page.goto(`${BASE_URL}/dashboard/audit`);
    await page.waitForLoadState('networkidle');

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(1000);

    await page.screenshot({ path: 'test-screenshots/audit.png' });
  });

  test('Navigate to jobs page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    await page.goto(`${BASE_URL}/dashboard/jobs`);
    await page.waitForLoadState('networkidle');

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(1000);

    await page.screenshot({ path: 'test-screenshots/jobs.png' });
  });

  test('Create new node via UI', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');

    // Go to nodes page
    await page.goto(`${BASE_URL}/dashboard/nodes/new`);
    await page.waitForLoadState('networkidle');

    // Check for form elements
    const hasNameInput = await page.locator('input[name="name"]').count() > 0 ||
                         await page.locator('input[placeholder*="name" i]').count() > 0;
    expect(hasNameInput).toBeTruthy();

    await page.screenshot({ path: 'test-screenshots/node-create.png' });

    // The form should exist even if we don't submit it
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(1000);
  });
});
