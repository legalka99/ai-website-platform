import type {
  ResultValidator,
  ValidationIssue,
  ValidationResult,
} from './validation.js';

export class DefaultResultValidator implements ResultValidator {
  async validate(
    output: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    if (output === null || output === undefined) {
      issues.push({
        code: 'OUTPUT_MISSING',
        message: 'Agent output is missing.',
      });

      return {
        valid: false,
        issues,
      };
    }

    if (typeof output !== 'object' || Array.isArray(output)) {
      issues.push({
        code: 'OUTPUT_INVALID_TYPE',
        message: 'Agent output must be an object.',
      });

      return {
        valid: false,
        issues,
      };
    }

    const keys = Object.keys(output);

    if (keys.length === 0) {
      issues.push({
        code: 'OUTPUT_EMPTY',
        message: 'Agent output must not be empty.',
      });
    }

    for (const [key, value] of Object.entries(output)) {
      if (value === null || value === undefined) {
        issues.push({
          code: 'OUTPUT_NULL_VALUE',
          message: `Output field "${key}" must not be null or undefined.`,
          field: key,
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
