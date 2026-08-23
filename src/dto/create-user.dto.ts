import { z } from 'zod';

export const CreateUserSchema = z.object({
    email: z.email(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
