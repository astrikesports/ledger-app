import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://uailyyqzbdgapkzhnoke.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhaWx5eXF6YmRnYXBremhub2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDUwNTMsImV4cCI6MjA5MDA4MTA1M30.qJcKajpZHu0POFD9Rp_yrmjzaiYdCGFHAgrqZiQIeHg";

export const supabase = createClient(supabaseUrl, supabaseKey);
