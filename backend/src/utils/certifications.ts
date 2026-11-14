export const movieCertifications = ['U', 'UA', 'A', 'S'] as const;

export type MovieCertification = (typeof movieCertifications)[number];
