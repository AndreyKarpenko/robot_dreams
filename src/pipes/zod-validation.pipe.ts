import { z } from 'zod';

import { ValidationError } from '../errors/validation.error';

export class ZodValidationPipe {
    constructor(private schema: z.ZodType) {}

    transform(value: unknown): unknown {
        const result = this.schema.safeParse(value);

        if (result.success) {
            return result.data;
        }

        throw new ValidationError(
            result.error.issues.map((issue) => ({
                field: issue.path.join('.') || 'root',
                message: issue.message,
            })),
        );
    }
}
