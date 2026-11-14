import mongoose, { Schema } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { movieGenres } from '../utils/genres';
import { movieStatus } from '../utils/constants';
import { movieLanguages } from '../utils/languages';
import { movieCertifications } from '../utils/certifications';

const castMemberSchema = new Schema(
    {
        personId: {
            type: Schema.Types.ObjectId,
            ref: 'Person',
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        characterName: {
            type: String,
            required: true,
            trim: true,
        },
        billingOrder: {
            type: Number,
            required: true,
            min: 0,
            validate: Number.isInteger,
        },
    },
    { _id: false },
);

const crewMemberSchema = new Schema(
    {
        personId: {
            type: Schema.Types.ObjectId,
            ref: 'Person',
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        job: {
            type: String,
            required: true,
            trim: true,
        },
    },
    { _id: false },
);

const movieSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 200,
        },
        synopsis: {
            type: String,
            required: true,
            maxlength: 3000,
        },
        runtimeMin: {
            type: Number,
            required: true,
            min: 1,
            validate: Number.isInteger,
        },
        language: {
            type: String,
            required: true,
            lowercase: true,
            enum: movieLanguages,
        },
        releaseDate: {
            type: Date,
            required: true,
        },
        certification: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            enum: movieCertifications,
        },
        posterUrl: {
            type: String,
            default: null,
        },
        trailerUrl: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(movieStatus),
            required: true,
        },
        genres: {
            type: [{ type: String, enum: movieGenres }],
            required: true,
            validate: {
                validator: (genres: string[]) => genres.length <= 6,
                message: 'A movie can have at most 6 genres',
            },
        },
        cast: {
            type: [castMemberSchema],
            default: [],
            validate: {
                validator: (members: unknown[]) => members.length <= 50,
                message: 'A movie can have at most 50 cast members',
            },
        },
        crew: {
            type: [crewMemberSchema],
            default: [],
            validate: {
                validator: (members: unknown[]) => members.length <= 20,
                message: 'A movie can have at most 20 crew members',
            },
        },
        ratingSum: {
            type: Number,
            default: 0,
            min: 0,
        },
        ratingCount: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
        ratingAvg: {
            type: Number,
            default: 0,
            min: 0,
            max: 10,
        },
        viewCount: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
    },
    { timestamps: true },
);

movieSchema.index(
    { title: 'text', 'cast.name': 'text', synopsis: 'text' },
    { weights: { title: 10, 'cast.name': 5, synopsis: 3 } },
);
movieSchema.index({ status: 1, releaseDate: -1 });
movieSchema.index({ genres: 1, status: 1, ratingAvg: -1 });
movieSchema.index({ language: 1, status: 1 });
movieSchema.index({ 'cast.personId': 1 });
movieSchema.index({ 'crew.personId': 1 });

export type MovieRecord = InferSchemaType<typeof movieSchema>;

const Movie = mongoose.model<MovieRecord>('Movie', movieSchema);

export default Movie;