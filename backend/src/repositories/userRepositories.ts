import User, { type UserRecord } from '../models/User';
import type { HydratedDocument } from 'mongoose';
import { userRole } from '../utils/constants';

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

export const hasAdminUser = async (): Promise<boolean> => {
    return (await User.exists({ role: userRole.admin })) !== null;
};

type NewUserData = Pick<UserRecord, 'name' | 'email' | 'passwordHash'> & Partial<Pick<UserRecord, 'role'>>;

export const createUserByData = async (userData: NewUserData): Promise<UserDocument> => {
    return await User.create(userData);
};

export const incrementTokenVersion = async (userId: string): Promise<void> => {
    await User.findOneAndUpdate({ _id: userId }, { $inc: { tokenVersion: 1 } });
};
