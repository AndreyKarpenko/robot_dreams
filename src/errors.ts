export type ValidationIssue = {
    field: string;
    message: string;
    code: string;
};

export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class NotFoundError extends HttpError {
    constructor(message = 'Resource not found') {
        super(404, message);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = 'Forbidden') {
        super(403, message);
    }
}

export class ValidationError extends HttpError {
    constructor(
        public readonly issues: ValidationIssue[],
        message = 'Validation failed',
    ) {
        super(400, message);
    }
}
