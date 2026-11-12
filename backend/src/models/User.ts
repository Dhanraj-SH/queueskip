import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { userRole, userStatus } from '../utils/constants';

const userSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 60,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        emailVerified: {
            type: Boolean,
            default: false,
        },
        verifyTokenHash: {
            type: String,
            default: null,
            select: false,
        },
        verifyTokenExpires: {
            type: Date,
            default: null,
            select: false,
        },
        passwordHash: {
            type: String,
            default: null,
            select: false,
        },
        role: {
            type: String,
            enum: Object.values(userRole),
            default: userRole.user,
        },
        status: {
            type: String,
            enum: Object.values(userStatus),
            default: userStatus.active,
        },
        tokenVersion: {
            type: Number,
            default: 0,
            select: false,
        },
        lastLoginAt: {
            type: Date,
            default: null,
        },
        schemaVersion: {
            type: Number,
            default: 1,
        },
    },
    {
        timestamps: true,
    },
);

export type UserRecord = InferSchemaType<typeof userSchema>;

const User = mongoose.model<UserRecord>('User', userSchema);

export default User;
