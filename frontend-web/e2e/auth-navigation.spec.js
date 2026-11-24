import { test, expect } from '@playwright/test';
import { setupAuthSession, ROLE_SESSIONS } from './helpers/auth';

test.describe('Authentication & Sidebar Navigation Flow', () => {
  test('Complete Login & Logout Flow', async ({ page }) => {
    // 1. Visit login page
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();

    // 2. Mock login API response
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock-jwt-token-admin',
          // RBAC v2 login response: role meta + platform + permissions
          user: {
            ...ROLE_SESSIONS.superadmin,
            id: 'admin-1',
            name: 'Super Administrator',
            email: 'superadmin@ctrack.com',
          },
        }),
      });
    });

    // Mock dashboard metrics and tasks
    await page.route('**/api/**', async (route) => {
      if (route.request().url().includes('/auth/login')) return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [], users: [], takenTasks: [], reports: [], locations: [] }),
      });
    });

    // 3. Fill form & Submit
    await page.getByLabel(/Email Address/i).fill('superadmin@ctrack.com');
    await page.getByLabel(/Password/i).fill('secretPassword123');
    await page.getByRole('button', { name: /Sign In/i }).click();

    // 4. Verify redirected to dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // 5. Verify Sidebar profile & user menu
    const userProfileTrigger = page.locator('.sidebar-user, .user-avatar, .user-menu-trigger, .sidebar-footer').first();
    if (await userProfileTrigger.isVisible()) {
      await userProfileTrigger.click();
    }

    // 6. Test Logout button if visible
    const logoutBtn = page.getByRole('button', { name: /Logout|Keluar/i }).or(page.locator('.logout-btn, .btn-logout, a:has-text("Logout")')).first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/.*login/);
    }
  });

  test('Sidebar Navigation across all portal pages and active states', async ({ page }) => {
    await setupAuthSession(page);

    // Mock API for all pages
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/tasks')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
      }
      if (url.includes('/users')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [] }) });
      }
      if (url.includes('/teams')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ teams: [] }) });
      }
      if (url.includes('/assignments') || url.includes('/taken')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ takenTasks: [] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*dashboard/);

    // Test Navigation to Task Management
    const taskLink = page.getByRole('link', { name: /Task|Tugas/i }).first();
    await taskLink.click();
    await expect(page).toHaveURL(/.*task/);

    // Test Navigation to Taken Tasks
    const takenLink = page.getByRole('link', { name: /Taken/i }).first();
    await takenLink.click();
    await expect(page).toHaveURL(/.*taken/);

    // Test Navigation to User Management
    const usersLink = page.getByRole('link', { name: /User|Pengguna/i }).first();
    await usersLink.click();
    await expect(page).toHaveURL(/.*users/);

    // Test Navigation to Team Management
    const teamsLink = page.getByRole('link', { name: /Team|Tim/i }).first();
    await teamsLink.click();
    await expect(page).toHaveURL(/.*teams/);

    // Test Navigation to Analytics
    const analyticsLink = page.getByRole('link', { name: /Analytics|Analitik/i }).first();
    await analyticsLink.click();
    await expect(page).toHaveURL(/.*analytics/);

    // Test Navigation to Chatbot
    const chatbotLink = page.getByRole('link', { name: /Chatbot|AI Assistant|Citi/i }).first();
    await chatbotLink.click();
    await expect(page).toHaveURL(/.*chatbot/);

    // Test Navigation back to Dashboard
    const dashboardLink = page.getByRole('link', { name: /Dashboard/i }).first();
    await dashboardLink.click();
    await expect(page).toHaveURL(/.*dashboard/);
  });
});
