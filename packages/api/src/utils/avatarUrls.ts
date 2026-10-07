import { generateAvatarUrl } from "@kan/shared/storage";

export const createAvatarUrlResolver = () => {
  const urlsByImageKey = new Map<string, Promise<string | null>>();

  return (imageKey: string) => {
    const cachedUrl = urlsByImageKey.get(imageKey);

    if (cachedUrl) return cachedUrl;

    const url = generateAvatarUrl(imageKey);
    urlsByImageKey.set(imageKey, url);

    return url;
  };
};
