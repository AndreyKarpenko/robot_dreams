export type ValidationIssue = {
    field: string;
    message: string;
};

export class ValidationError extends Error {
    constructor(public readonly errors: ValidationIssue[]) {
        super('Validation failed');
        this.name = 'ValidationError';
    }
}
