export const compatibility = [
  ["Search", ["google.com", "bing.com", "duckduckgo.com"]],
  ["Email", ["gmail.com", "outlook.com"]],
  ["Social / chat", ["discord.com", "instagram.com", "facebook.com", "whatsapp.com", "messenger.com", "threads.net", "reddit.com", "x.com", "tiktok.com", "telegram.org"]],
  ["Media", ["youtube.com", "twitch.tv", "spotify.com", "soundcloud.com", "bandcamp.com", "vimeo.com", "dailymotion.com", "rumble.com", "kick.com"]],
  ["Games", ["newgrounds.com", "crazygames.com", "poki.com", "gamejolt.com", "gamedistribution.com", "y8.com", "kongregate.com", "miniclip.com", "armorgames.com", "coolmathgames.com", "itch.io"]],
  ["Minecraft / modding", ["packsmc.com", "minecraft.net", "minecraftservices.com", "mojang.com", "planetminecraft.com", "minecraftskins.com", "modrinth.com", "curseforge.com", "fabricmc.net", "papermc.io", "spigotmc.org", "hypixel.net", "lunarclient.com", "badlion.net", "moddb.com", "gamebanana.com", "nexusmods.com"]],
  ["Development / education", ["github.com", "gitlab.com", "wikipedia.org", "archive.org", "desmos.com", "geogebra.org"]],
].flatMap(([category, domains]) => domains.map((domain) => ({
  domain, category, recommendedRoute: "proxy",
  status: "UNVERIFIED",
  note: "Pages remain embedded. Proxy compatibility must be tested individually; login, sockets and origin-sensitive features are not guaranteed. Direct iframes may be denied.",
})));
