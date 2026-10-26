import { createClient } from "@supabase/supabase-js";
import { backend } from "./backend";
import type { Database } from "./database.types";

if (backend === "local") throw new Error("本地后端不能调用旧业务数据源。");

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("缺少 Supabase 本地客户端配置。");
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey);
