-- RBAC v2: dynamic roles, permission metadata, task creator, audit log.
-- Additive only. Run `npm run rbac:sync` afterwards to fill roles/permissions data.

ALTER TABLE `roles`
  ADD COLUMN `display_name`    VARCHAR(100) NULL,
  ADD COLUMN `description`     TEXT NULL,
  ADD COLUMN `level`           INT NOT NULL DEFAULT 10,
  ADD COLUMN `platform`        ENUM('web', 'mobile') NOT NULL DEFAULT 'web',
  ADD COLUMN `is_system`       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `color`           VARCHAR(20) NULL,
  ADD COLUMN `show_task_badge` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `permissions`
  ADD COLUMN `module`      VARCHAR(50) NULL,
  ADD COLUMN `label`       VARCHAR(100) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `sort_order`  INT NOT NULL DEFAULT 0;

ALTER TABLE `tasks`
  ADD COLUMN `created_by_id`        CHAR(36) NULL,
  ADD COLUMN `created_by_role_name` VARCHAR(255) NULL,
  ADD INDEX `tasks_created_by_id_foreign` (`created_by_id`),
  ADD CONSTRAINT `tasks_created_by_id_foreign` FOREIGN KEY (`created_by_id`)
      REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

CREATE TABLE `rbac_audit_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_id`    CHAR(36) NULL,
  `action`      VARCHAR(50) NOT NULL,
  `target_type` VARCHAR(50) NOT NULL,
  `target_id`   VARCHAR(64) NOT NULL,
  `before`      JSON NULL,
  `after`       JSON NULL,
  `created_at`  TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  INDEX `rbac_audit_logs_target` (`target_type`, `target_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
