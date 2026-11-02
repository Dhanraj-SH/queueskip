import User, { type UserRecord } from '../models/User';

export const findUserByEmail = async (email: string): Promise<UserRecord | null> => {
    return User.findOne({ email });
};

type NewUserData = Pick<UserRecord, 'name' | 'email' | 'passwordHash'>;

export const createUserByData = async (userData: NewUserData): Promise<UserRecord> => {
    return User.create(userData);
};
