import { z } from 'zod';

export const validateObjectId =  z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id").transform((value) => value.toLowerCase());