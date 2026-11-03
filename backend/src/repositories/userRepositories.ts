import User, { type UserRecord } from '../models/User';
import type { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<UserRecord>;

export const findUserByEmail = async (email: string): Promise<UserDocument | null> => {
    return await User.findOne({ email });
};

export const findUserById = async (userId: string): Promise<UserDocument | null> => {
    return await User.findById(userId).select('+tokenVersion');
};

export const findUserByEmailForLogin = async (email: string): Promise<UserDocument | null> => {
    return await User.findOne({ email }).select('+passwordHash +tokenVersion');
};

type NewUserData = Pick<UserRecord, 'name' | 'email' | 'passwordHash'>;

export const createUserByData = async (userData: NewUserData): Promise<UserDocument> => {
    return await User.create(userData);
};
