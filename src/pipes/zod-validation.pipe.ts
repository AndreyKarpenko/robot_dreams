import type { ZodType } from 'zod';

import { ValidationError, type ValidationIssue } from '../errors';
import type { ArgumentMetadata, PipeTransform } from '../lifecycle';

/**
 * Zod 4 reports problems in `error.issues` (Zod 3 used `error.errors`).
 * Every issue carries the `path` to the offending field, which is exactly what
 * the client needs in a 400 response.
 */
function toIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }>) {
    return issues.map<ValidationIssue>((issue) => ({
        field: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
        code: issue.code,
    }));
}

export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
    constructor(private readonly schema: ZodType<TOutput>) {}

    transform(value: unknown, metadata: ArgumentMetadata): TOutput {
        const result = this.schema.safeParse(value);

        if (!result.success) {
            const target = metadata.name ? `${metadata.type} "${metadata.name}"` : metadata.type;

            throw new ValidationError(
                toIssues(result.error.issues),
                `Validation failed for ${target}`,
            );
        }

        return result.data;
    }
}
