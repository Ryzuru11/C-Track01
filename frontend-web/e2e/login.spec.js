import { test, expect } from '@playwright/test';
import { ROLE_SESSIONS } from './helpers/auth';

test.describe('E2E Login Flow', () => {
  test('should display login page elements correctly', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
    await expect(page.getByLabel(/Email Address/i)).toBeVisible();
    await expect(page.getByLabel(/Password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible();
  });

  test('should show error when login fails with invalid credentials', async ({ page }) => {
    // Mock the backend auth endpoint to return 401
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid credentials' }),
      });
    });

    await page.goto('/login');

    await page.getByLabel(/Email Address/i).fill('wrong@example.com');
    await page.getByLabel(/Password/i).fill('wrongpass');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
  });

  test('should navigate to dashboard upon successful admin login', async ({ page }) => {
    // Mock successful login response
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock-valid-admin-jwt-token',
          // RBAC v2 login response: role meta + platform + permissions
          user: {
            ...ROLE_SESSIONS.admin,
            id: 'admin-1',
            name: 'Admin User',
            email: 'admin@example.com',
          },
        }),
      });
    });

    await page.goto('/login');

    await page.getByLabel(/Email Address/i).fill('admin@example.com');
    await page.getByLabel(/Password/i).fill('correctpassword');
    await page.getByRole('button', { name: /Sign In/i }).click();

    // Verify redirection to /dashboard
    await expect(page).toHaveURL(/.*dashboard/);
  });
});
