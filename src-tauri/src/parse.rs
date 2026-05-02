#[derive(Debug, Clone)]
pub struct SelectMeta {
    pub table: Option<String>,
    pub schema: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub is_select: bool,
    pub is_simple: bool,
}

fn clean_ident(s: &str) -> Option<String> {
    let t = s.trim().trim_matches('"').trim_matches('`');
    if t.is_empty() {
        return None;
    }
    if t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Some(t.to_string())
    } else {
        None
    }
}

pub fn parse_select(sql: &str) -> SelectMeta {
    let s = sql.trim();
    let is_select = s.to_lowercase().starts_with("select");
    if !is_select {
        return SelectMeta {
            table: None,
            schema: None,
            limit: None,
            offset: None,
            is_select: false,
            is_simple: false,
        };
    }

    let lower = s.to_lowercase();
    let is_simple = !lower.contains(" join ")
        && !lower.contains(" union ")
        && !lower.contains(" group by ")
        && !lower.contains(" having ")
        && !lower.contains(" distinct ")
        && !lower.contains(" with ");

    let mut table = None;
    let mut schema = None;
    let from_pos = lower
        .rfind(" from ")
        .or_else(|| lower.rfind("\nfrom "))
        .or_else(|| lower.rfind("\tfrom "));
    if let Some(pos) = from_pos {
        let after = &s[pos + 6..];
        let token = after
            .trim_start()
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(';');
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() == 1 {
            table = clean_ident(parts[0]);
        } else if parts.len() == 2 {
            schema = clean_ident(parts[0]);
            table = clean_ident(parts[1]);
        }
    }

    let mut limit = None;
    let mut offset = None;
    if let Some(pos) = lower.rfind(" limit ") {
        let after = &lower[pos + 7..];
        let mut it = after.trim_start().chars().peekable();
        let mut num = String::new();
        while let Some(c) = it.peek() {
            if c.is_ascii_digit() {
                num.push(*c);
                it.next();
            } else {
                break;
            }
        }
        limit = num.parse::<u64>().ok();
        if let Some(off_pos) = after.find("offset") {
            let after_off = &after[off_pos + 6..];
            let digits = after_off
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>();
            offset = digits.parse::<u64>().ok();
        } else if limit.is_some() {
            offset = Some(0);
        }
    }

    SelectMeta {
        table,
        schema,
        limit,
        offset,
        is_select: true,
        is_simple,
    }
}
