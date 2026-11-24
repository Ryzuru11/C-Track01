import { test, expect } from '@playwright/test';
import { setupAuthSession } from './helpers/auth';

test.describe('User & Team Management Flows & Buttons', () => {
  const mockUsers = [
    {
      id: 'u-1',
      name: 'Ahmad Dahlan',
      email: 'ahmad@example.com',
      role: 'superadmin',
      status: 'active',
      department: 'IT Infrastructure',
      position: 'Lead Engineer',
      phoneNumber: '081234567890',
    },
    {
      id: 'u-2',
      name: 'Siti Aminah',
      email: 'siti@example.com',
      role: 'admin',
      status: 'active',
      department: 'Operations',
      position: 'Field Supervisor',
      phoneNumber: '081298765432',
    },
    {
      id: 'u-3',
      name: 'Rian Pratama',
      email: 'rian@example.com',
      role: 'employee',
      status: 'active',
      department: 'Field Operations',
      position: 'Technician',
      phoneNumber: '081211223344',
    },
  ];

  const mockTeams = [
    {
      id: 'team-1',
      name: 'Alpha Response Team',
      description: 'Tim respon cepat perbaikan tower dan kabel',
      status: 'active',
      leader: { id: 'u-2', name: 'Siti Aminah' },
      members: [{ id: 'u-3', name: 'Rian Pratama' }],
      _count: { members: 1 },
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);

    // Mock Users API
    await page.route('**/api/admin/users**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ users: mockUsers }),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              id: 'u-new-created',
              ...body,
              status: 'active',
            },
          }),
        });
      }
      return route.fallback();
    });

    // Mock Teams API
    await page.route('**/api/admin/teams**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ teams: mockTeams }),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            team: {
              id: 'team-new-created',
              ...body,
              members: [],
              _count: { members: 0 },
            },
          }),
        });
      }
      return route.fallback();
    });
  });

  test('User Management: Header, Summary cards, Filters, and Add User modal', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/.*users/);

    // 1. Verify Page Title & Add User button
    await expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible();
    const addUserBtn = page.getByRole('button', { name: /Add User/i });
    await expect(addUserBtn).toBeVisible();

    // 2. Test Summary Cards Filtering (one card per role present, labelled by roleDisplayName)
    const roleCard = (label) =>
      page.locator('.summary-card').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) });
    const totalCard = roleCard('Total');
    const superAdminCard = roleCard('Superadmin');
    const adminsCard = roleCard('Admin');
    const employeesCard = roleCard('Employee');

    await superAdminCard.click();
    await expect(superAdminCard).toHaveClass(/active-summary/);

    await adminsCard.click();
    await expect(adminsCard).toHaveClass(/active-summary/);

    await employeesCard.click();
    await expect(employeesCard).toHaveClass(/active-summary/);

    await totalCard.click();
    await expect(totalCard).toHaveClass(/active-summary/);

    // 3. Test Add User Modal Open, Fill Form, and Cancel
    await addUserBtn.click();
    const modal = page.locator('.modal-content').first();
    await expect(modal).toBeVisible();

    // Fill form fields
    const nameInput = page.locator('input[name="name"], input#name');
    if (await nameInput.isVisible()) {
      await nameInput.fill('Doni Prasetyo');
    }
    const emailInput = page.locator('input[name="email"], input#email');
    if (await emailInput.isVisible()) {
      await emailInput.fill('doni@example.com');
    }

    // Cancel modal
    const cancelBtn = page.locator('.btn-cancel, button:has-text("Cancel"), button:has-text("Batal")').first();
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test('Team Management: Header, Team cards, and Create Team modal', async ({ page }) => {
    await page.goto('/teams');
    await expect(page).toHaveURL(/.*teams/);

    // 1. Verify Page Title
    await expect(page.getByRole('heading', { name: /Team Management|Manajemen Tim/i })).toBeVisible();

    // 2. Test Create Team button and modal
    const createTeamBtn = page.locator('.btn-tambah, button:has-text("Create Team"), button:has-text("Tambah Tim")').first();
    if (await createTeamBtn.isVisible()) {
      await createTeamBtn.click();

      const teamModal = page.locator('.modal-content, .team-modal').first();
      await expect(teamModal).toBeVisible();

      // Test Cancel / Close modal button
      const cancelBtn = page.locator('.btn-cancel, .modal-close, button:has-text("Cancel"), button:has-text("Batal")').first();
      await cancelBtn.click();
      await expect(teamModal).not.toBeVisible();
    }
  });
});
