import User, { type UserRecord } from '../models/User';
import type { FilterQuery, HydratedDocument } from 'mongoose';
import { userRole } from '../utils/constants';
import { escapeRegex } from '../utils/escapeRegex';
import type { ListUsersQuery } from '../validators/admin';

export type UserDocument = HydratedDocument<UserRecord>;

export const findUserByEmail = async (email: string): Promise<UserDocument | null> => {
    return await User.findOne({ email });
};

export const findUserById = async (userId: string): Promise<UserDocument | null> => {
    return await User.findById(userId).select('+tokenVersion');
};

export const findUserByIdForPasswordChange = async (userId: string): Promise<UserDocument | null> => {
    return await User.findById(userId).select('+passwordHash +tokenVersion');
};

export const findUserByEmailForLogin = async (email: string): Promise<UserDocument | null> => {
    return await User.findOne({ email }).select('+passwordHash +tokenVersion');
};

export const hasAdminUser = async (): Promise<boolean> => {
    return (await User.exists({ role: userRole.admin })) !== null;
};

export const listUsers = async (query: ListUsersQuery) => {
    const { q, role, status, page, limit } = query;
    const filter: FilterQuery<UserRecord> = {};

    if (q) {
        const search = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ name: search }, { email: search }];
    }

    if (role) {
        filter.role = role;
    }

    if (status) {
        filter.status = status;
    }

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
        User.find(filter)
            .select('name email role status createdAt')
            .sort({ createdAt: -1, _id: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(filter),
    ]);

    return {
        users,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

type NewUserData = Pick<UserRecord, 'name' | 'email' | 'passwordHash'> & Partial<Pick<UserRecord, 'role'>>;

export const createUserByData = async (userData: NewUserData): Promise<UserDocument> => {
    return await User.create(userData);
};

export const changeUserPassword = async (userId: string, passwordHash: string): Promise<UserDocument | null> => {
    return await User.findByIdAndUpdate(
        userId,
        { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
        { returnDocument: "after", runValidators: true }
    ).select('+tokenVersion');
};

export const updateUserProfile = async(userId: string, name: string): Promise<UserDocument | null> => {
    return await User.findByIdAndUpdate(
        userId,
        { $set: {name} },
        { returnDocument: "after", runValidators: true }
    );
};

export const incrementTokenVersion = async (userId: string): Promise<void> => {
    await User.findOneAndUpdate({ _id: userId }, { $inc: { tokenVersion: 1 } });
};
