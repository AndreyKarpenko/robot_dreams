import { z } from 'zod';

export class ZodValidationPipe {
    constructor(private schema: z.ZodType) {}

    transform(value: unknown): unknown {
        return this.schema.parse(value);
    }
}
