import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

export type ValidationIssue = {
    field: string;
    constraints?: Record<string, string>;
};

export class ValidationException extends Error {
    constructor(public readonly errors: ValidationIssue[]) {
        super('Validation failed');
        this.name = 'ValidationException';
    }
}

const BUILTIN_TYPES = new Set<unknown>([String, Number, Boolean, Array, Object]);

function flattenErrors(errors: ValidationError[], parent?: string): ValidationIssue[] {
    return errors.flatMap((error) => {
        const field = parent ? `${parent}.${error.property}` : error.property;
        const current: ValidationIssue[] = error.constraints
            ? [{ field, constraints: error.constraints }]
            : [];
        const nested = error.children?.length ? flattenErrors(error.children, field) : [];

        return [...current, ...nested];
    });
}

export class ValidationPipe {
    async transform(value: unknown, metatype?: ClassConstructor<unknown>): Promise<unknown> {
        if (!metatype || BUILTIN_TYPES.has(metatype)) {
            return value;
        }

        const instance = plainToInstance(metatype, value);
        const errors = await validate(instance as object, { whitelist: true });

        if (errors.length > 0) {
            throw new ValidationException(flattenErrors(errors));
        }

        return instance;
    }
}
