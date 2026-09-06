-- FIX: roles.role_code was declared CHAR(36) (fixed-length). Postgres pads CHAR values with
-- trailing spaces on SELECT, so any code that read role.roleCode and wrote it elsewhere
-- (e.g. UserProfile.actor_role) ended up with padded/garbage values. role_code is a
-- variable-length business code (e.g. 'PATIENT', 'DOCTOR', 'LAB_STAFF') — it must be VARCHAR.

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "role_code" TYPE VARCHAR(36);

-- Backfill: trim any pre-existing padded role_code values (defensive, CHAR->VARCHAR cast
-- itself does not strip trailing spaces already stored on disk).
UPDATE "roles" SET "role_code" = TRIM(TRAILING FROM "role_code");

-- Backfill: re-sync user_profiles.actor_role from the user's current role assignment,
-- for every user that already has a role assigned. This fixes historical drift caused by:
--   1) role_code padding described above, and
--   2) DEFAULT_ACTOR_ROLE previously being 'patient' (lowercase) while roles.role_code
--      seeds as 'PATIENT' (uppercase).
-- Users with NO role assignment are left untouched here (application-level default applies).
UPDATE "user_profiles" up
SET "actor_role" = TRIM(TRAILING FROM r."role_code")
FROM "user_roles" ur
JOIN "roles" r ON r."role_id" = ur."role_id"
WHERE ur."user_id" = up."user_id";
