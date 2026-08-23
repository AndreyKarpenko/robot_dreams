import { IsEmail } from 'class-validator';
import { z } from 'zod';

export class CreateUserDtoOld {
    @IsEmail()
    email!: string;
}

export const CreateUserSchema = z.object({
    email: z.email(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
