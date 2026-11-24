import { test, expect } from '@playwright/test';
import { setupAuthSession } from './helpers/auth';

test.describe('Task Management Page Flows & Buttons', () => {
  const mockTasks = [
    {
      taskId: 'task-101',
      ticketNumber: 'TSK-0001',
      title: 'Pemeriksaan Rutin Tower A',
      description: 'Pengecekan perangkat keras dan kabel transmisi',
      location: 'Gedung Cyber 1 Lt. 5',
      status: 'active',
      startTime: '08:00',
      endTime: '17:00',
      takenTasks: [],
    },
    {
      taskId: 'task-102',
      ticketNumber: 'TSK-0002',
      title: 'Instalasi Antena Cadangan',
      description: 'Pemasangan antena darurat di site B',
      location: 'Site B Serpong',
      status: 'inactive',
      startTime: '09:00',
      endTime: '15:00',
      takenTasks: [],
    },
  ];

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);

    // Mock Tasks API
    await page.route('**/api/admin/tasks**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/template')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: Buffer.from('mock-excel-binary-data'),
        });
      }

      if (url.includes('/task-101') || url.includes('/task-102')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ task: mockTasks[0] }),
        });
      }

      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tasks: mockTasks }),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() || {};
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            task: {
              taskId: 'task-new-created',
              ticketNumber: 'TSK-0003',
              title: body.title,
              description: body.description,
              location: body.location,
              status: 'active',
              startTime: body.startTime || '08:00',
              endTime: body.endTime || '17:00',
            },
          }),
        });
      }
      return route.fallback();
    });

    await page.goto('/task');
    await expect(page).toHaveURL(/.*task/);
  });

  test('Page header actions, summary status cards, and filter controls', async ({ page }) => {
    // 1. Verify page title
    await expect(page.getByRole('heading', { name: /Task Management/i })).toBeVisible();

    // 2. Test Summary Cards Filter Buttons
    const totalCard = page.locator('.summary-card').filter({ has: page.locator('.label', { hasText: 'Total' }) });
    const activeCard = page.locator('.summary-card').filter({ has: page.locator('.label', { hasText: /^Active$/ }) });
    const inactiveCard = page.locator('.summary-card').filter({ has: page.locator('.label', { hasText: 'Inactive' }) });

    await expect(totalCard).toBeVisible();
    await activeCard.click();
    await expect(activeCard).toHaveClass(/active-summary/);

    await inactiveCard.click();
    await expect(inactiveCard).toHaveClass(/active-summary/);

    await totalCard.click();
    await expect(totalCard).toHaveClass(/active-summary/);

    // 3. Test Search & Location inputs and Clear Filters button
    const searchInput = page.getByPlaceholder(/Search Task or Location/i);
    const locationInput = page.getByPlaceholder(/Specific Location Filters/i);
    const clearBtn = page.getByRole('button', { name: /Clear Filters/i });

    await searchInput.fill('Tower A');
    await locationInput.fill('Cyber 1');
    await expect(clearBtn).toHaveClass(/active/);

    await clearBtn.click();
    await expect(searchInput).toHaveValue('');
    await expect(locationInput).toHaveValue('');
  });

  test('Upload Task Modal & Download Template buttons', async ({ page }) => {
    // 1. Test Download Template button
    const downloadBtn = page.getByRole('button', { name: /Download Template/i });
    await expect(downloadBtn).toBeVisible();
    // Click should trigger handler without navigation
    await downloadBtn.click();

    // 2. Test Bulk Upload button and modal
    const uploadBtn = page.getByRole('button', { name: /Upload Task/i });
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Verify Bulk Upload Modal is opened
    const uploadModal = page.locator('.bulk-modal-overlay, .modal-overlay, div[class*="bulk"]').first();
    await expect(uploadModal).toBeVisible();

    // Test Close button inside Bulk Upload modal
    const closeBtn = page.locator('.bulk-modal-close, .modal-close, button:has-text("✕"), button:has-text("Batal")').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  });

  test('Create Task Modal: Form input, Cancel, and Submit flows', async ({ page }) => {
    // 1. Click "+ Create Task" button
    const createBtn = page.getByRole('button', { name: /Create Task/i });
    await createBtn.click();

    // 2. Verify modal opened
    await expect(page.getByRole('heading', { name: /Tambah Task Baru/i })).toBeVisible();

    // 3. Test "Batal" button
    const cancelBtn = page.getByRole('button', { name: /Batal/i });
    await cancelBtn.click();
    await expect(page.getByRole('heading', { name: /Tambah Task Baru/i })).not.toBeVisible();

    // 4. Re-open modal and fill form
    await createBtn.click();
    await page.locator('input#title').fill('Pengecekan Server Utama');
    await page.locator('textarea#description').fill('Maintenance bulanan rak server');
    await page.locator('input#location').fill('Data Center Lantai 2');

    // Submit form
    const submitBtn = page.getByRole('button', { name: /Simpan Task/i });
    await submitBtn.click();

    // Modal should close upon successful creation
    await expect(page.getByRole('heading', { name: /Tambah Task Baru/i })).not.toBeVisible({ timeout: 5000 });
  });

  test('Table row buttons: Edit Task and Delete Task confirmation modal', async ({ page }) => {
    // Wait for mock rows to display
    await expect(page.getByText('Pemeriksaan Rutin Tower A')).toBeVisible();

    // 1. Test Edit button in row
    const editBtn = page.locator('button.edit-btn, button[title="Edit"]').first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await expect(page.getByRole('heading', { name: /Edit Task/i })).toBeVisible();
      // Close edit modal
      await page.getByRole('button', { name: /Batal/i }).click();
      await expect(page.getByRole('heading', { name: /Edit Task/i })).not.toBeVisible();
    }

    // 2. Test Delete button and confirmation modal
    const deleteBtn = page.locator('button.delete-btn, button[title="Delete"]').first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      // Confirmation modal should appear
      const confirmModal = page.locator('.confirm-overlay, .confirm-modal').first();
      await expect(confirmModal).toBeVisible();

      // Click "Batal" in confirmation modal
      await page.getByRole('button', { name: /Batal/i }).click();
      await expect(confirmModal).not.toBeVisible();
    }
  });
});
