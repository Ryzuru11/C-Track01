import { test, expect } from '@playwright/test';
import { setupAuthSession } from './helpers/auth';

test.describe('Taken Tasks & Live Monitoring Flows & Buttons', () => {
  const mockTakenTasks = [
    {
      id: 'taken-1',
      taskId: 'task-101',
      ticketNumber: 'TSK-0001',
      title: 'Pemeriksaan Rutin Tower A',
      status: 'in_progress',
      location: 'Gedung Cyber 1 Lt. 5',
      date: '2026-10-13',
      users: [
        { id: 'u1', name: 'Budi Santoso', email: 'budi@example.com' },
      ],
      userStatuses: { u1: 'in_progress' },
      task: {
        taskId: 'task-101',
        title: 'Pemeriksaan Rutin Tower A',
        location: 'Gedung Cyber 1 Lt. 5',
      },
    },
    {
      id: 'taken-2',
      taskId: 'task-102',
      ticketNumber: 'TSK-0002',
      title: 'Instalasi Antena Cadangan',
      status: 'pending',
      location: 'Site B Serpong',
      date: '2026-10-13',
      users: [],
      userStatuses: {},
      task: {
        taskId: 'task-102',
        title: 'Instalasi Antena Cadangan',
        location: 'Site B Serpong',
      },
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);

    // Mock Taken API
    await page.route('**/api/admin/assignments**', async (route) => {
      const url = route.request().url();
      if (url.includes('/taken-1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            assignment: mockTakenTasks[0],
            takenTask: mockTakenTasks[0],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ takenTasks: mockTakenTasks }),
      });
    });

    await page.route('**/api/reports**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [] }),
      });
    });

    await page.route('**/api/locations**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ locations: [], current_locations: [] }),
      });
    });

    await page.route('**/api/admin/tasks**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [] }),
      });
    });

    await page.route('**/api/admin/users**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [] }),
      });
    });

    await page.route('**/api/admin/teams**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ teams: [] }),
      });
    });
  });

  test('Taken page summary cards, filters, and Assign Task modal controls', async ({ page }) => {
    await page.goto('/taken');
    await expect(page).toHaveURL(/.*taken/);

    // 1. Verify Header & Assign Task button
    await expect(page.getByRole('heading', { name: /Task Assignment Management/i })).toBeVisible();
    const assignBtn = page.getByRole('button', { name: /Assign Task/i });
    await expect(assignBtn).toBeVisible();

    // 2. Test Summary Cards Filtering
    const totalCard = page.locator('.summary-card', { hasText: 'Total' });
    const inProgressCard = page.locator('.summary-card', { hasText: 'In Progress' });
    const pendingCard = page.locator('.summary-card', { hasText: 'Pending' });
    const completedCard = page.locator('.summary-card', { hasText: 'Completed' });

    await inProgressCard.click();
    await expect(inProgressCard).toHaveClass(/active-summary/);

    await pendingCard.click();
    await expect(pendingCard).toHaveClass(/active-summary/);

    await completedCard.click();
    await expect(completedCard).toHaveClass(/active-summary/);

    await totalCard.click();
    await expect(totalCard).toHaveClass(/active-summary/);

    // 3. Test Assign Task Modal Open & Close
    await assignBtn.click();
    const modal = page.locator('.modal-content, .modal-overlay').first();
    await expect(modal).toBeVisible();

    // Close modal via Cancel / Close button
    const closeBtn = page.locator('.modal-close, button:has-text("Batal"), button:has-text("Cancel")').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(modal).not.toBeVisible();
    }
  });

  test('Monitoring Page Navigation, Map rendering, and Back button flow', async ({ page }) => {
    // Navigate directly to monitoring
    await page.goto('/monitoring/taken-1');
    await expect(page).toHaveURL(/.*monitoring\/taken-1/);

    // 1. Verify Compact Header & Title
    await expect(page.getByText('Pemeriksaan Rutin Tower A')).toBeVisible();
    await expect(page.getByText('Gedung Cyber 1 Lt. 5')).toBeVisible();

    // 2. Verify Map container rendered
    const mapContainer = page.locator('.leaflet-container, .monitoring-map-section').first();
    await expect(mapContainer).toBeVisible();

    // 3. Verify Activity Panel presence
    const activityPanel = page.locator('.activity-panel, .panel-tabs').first();
    if (await activityPanel.isVisible()) {
      // Check tabs if rendered
      const logsTab = page.locator('button:has-text("Logs"), button:has-text("Riwayat Lokasi")').first();
      if (await logsTab.isVisible()) {
        await logsTab.click();
      }
    }

    // 4. Test Back Button back to /taken
    const backBtn = page.locator('button.back-button').first();
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page).toHaveURL(/.*taken/);
  });
});
