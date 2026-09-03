export const readFile = async (): Promise<never> => {
  throw new Error('Filesystem reads are unavailable in the browser runtime.');
};
