import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export class ValidationPipe {
    async transform<T extends object>(value: unknown, metatype: new () => T): Promise<T> {
        const instance = plainToInstance(metatype, value);

        const errors = await validate(instance);

        if (errors.length > 0) {
            throw errors;
        }

        return instance;
    }
}
