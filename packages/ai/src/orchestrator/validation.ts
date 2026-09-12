export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ResultValidator {
  validate(output: Record<string, unknown>): Promise<ValidationResult>;
}
