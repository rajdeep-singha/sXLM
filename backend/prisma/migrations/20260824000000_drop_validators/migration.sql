-- Drop the validator model.
--
-- Stellar has no validator staking and no slashing, so these tables recorded
-- uptime and performance scores for a delegation mechanism that does not
-- exist. The vault's risk surface is solvency and, once strategies land,
-- strategy exposure — neither of which is per-validator.

-- DropForeignKey
ALTER TABLE "validator_history" DROP CONSTRAINT IF EXISTS "validator_history_validatorId_fkey";

-- DropTable
DROP TABLE IF EXISTS "validator_history";

-- DropTable
DROP TABLE IF EXISTS "validators";

-- AlterTable: protocol metrics no longer carry an average validator score
ALTER TABLE "protocol_metrics" DROP COLUMN IF EXISTS "avgValidatorScore";
