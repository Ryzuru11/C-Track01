import { test, expect } from '@playwright/test';
import { setupAuthSession } from './helpers/auth';

test.describe('Analytics & Chatbot AI Assistant Flows & Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);

    // Mock Analytics API
    await page.route('**/api/analytics**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          taskStats: { total: 12, completed: 8, pending: 3, inProgress: 1 },
          userStats: { active: 10, total: 15 },
          completionRate: 67,
          weeklyTrends: [5, 8, 12, 10, 7, 9, 8],
        }),
      });
    });

    // Mock AI Chatbot APIs
    await page.route('**/api/ai/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/model-limits') || url.includes('/models')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            models: [
              { name: 'llama-3.1-8b-instant', requests_today: 5, remaining_requests: 1195 },
            ],
          }),
        });
      }
      if (url.includes('/agent') || url.includes('/chat')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            answer: 'Halo! Semua 8 tugas yang dijadwalkan hari ini telah selesai dengan baik.',
            intent: 'ANALYTICS',
            usedAI: true,
            fromCache: false,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
  });

  test('Analytics Page: View metrics, charts, and date filter controls', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/.*analytics/);

    // 1. Verify Page Title
    await expect(page.getByRole('heading', { name: /Employee Analytics|Analytics/i })).toBeVisible({ timeout: 10000 });

    // 2. Verify filter buttons / dropdowns if present
    const dateFilterBtn = page.locator('button:has-text("Hari ini"), button:has-text("Bulan Ini"), select, .date-filter-btn').first();
    if (await dateFilterBtn.isVisible()) {
      await dateFilterBtn.click();
    }

    // 3. Verify analytics cards / chart containers
    const metricSection = page.locator('.an-summary-grid, .an-page, .main-content').first();
    await expect(metricSection).toBeVisible();
  });

  test('Chatbot Page: New message input, Send button, and Assistant response flow', async ({ page }) => {
    await page.goto('/chatbot');
    await expect(page).toHaveURL(/.*chatbot/);

    // 1. Verify welcome message from Citi
    await expect(page.locator('.messages-container')).toBeVisible();

    // 2. Locate message input textarea
    const messageInput = page.getByPlaceholder(/Tanyakan sesuatu ke Citi/i);
    await expect(messageInput).toBeVisible();

    // 3. Type question
    const testPrompt = 'Berapa total tugas yang selesai hari ini?';
    await messageInput.fill(testPrompt);

    // 4. Click Send button
    const sendButton = page.locator('button.send-button, button[aria-label="Kirim pesan"]').first();
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // 5. Verify user's message appears in message bubbles
    await expect(page.getByText(testPrompt)).toBeVisible();

    // 6. Verify Citi AI response appears
    await expect(page.getByText('Semua 8 tugas yang dijadwalkan hari ini telah selesai dengan baik.')).toBeVisible({ timeout: 10000 });
  });
});
