import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';

const personSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 60,
        },
        bio: {
            type: String,
            trim: true,
            minlength: 2,
            maxlength: 500,
        },
        photoUrl: {
            type: String,
            trim: true,
            maxlength: 2048,
            default: null,
            validate: {
                validator: (value: string | null) =>
                    value == null || /^https?:\/\/\S+$/i.test(value),
                message: 'photoUrl must be a valid HTTP or HTTPS URL',
            },
        },
        birthDate: {
            type: Date,
            default: null,
            validate: {
                validator: (value: Date | null) =>
                    value == null || (value.getTime() <= Date.now()),
                message: 'birthDate cannot be in the future',
            },
        },
    },
    {
        timestamps: true,
    },
);

personSchema.index({ name: 1 });

export type PersonRecord = InferSchemaType<typeof personSchema>;

const Person = mongoose.model<PersonRecord>('Person', personSchema);

export default Person;