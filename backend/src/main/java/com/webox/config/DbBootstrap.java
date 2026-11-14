package com.webox.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Creates the 17-table schema and seed data on first start (idempotent). */
@Component
public class DbBootstrap implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DbBootstrap.class);
    private final JdbcTemplate jdbc;

    public DbBootstrap(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        Integer tables = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'",
                Integer.class);
        if (tables != null && tables > 0) {
            log.info("Database schema present; skipping bootstrap");
            return;
        }
        String sql = new String(new ClassPathResource("db/schema.sql").getInputStream().readAllBytes(),
                StandardCharsets.UTF_8);
        List<String> statements = split(sql);
        log.info("Bootstrapping database with {} statements", statements.size());
        for (String s : statements) {
            if (!s.isBlank()) jdbc.execute(s);
        }
        log.info("Database bootstrap complete");
    }

    private List<String> split(String sql) {
        StringBuilder cleaned = new StringBuilder();
        for (String line : sql.split("\n")) {
            String t = line.stripLeading();
            if (t.startsWith("--") || t.startsWith("SET ") || t.isBlank()) continue;
            cleaned.append(line).append('\n');
        }
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inSingle = false;
        char[] chars = cleaned.toString().toCharArray();
        for (int i = 0; i < chars.length; i++) {
            char c = chars[i];
            if (c == '\'' ) {
                boolean escaped = i > 0 && chars[i - 1] == '\\';
                if (!escaped) inSingle = !inSingle;
            }
            if (c == ';' && !inSingle) {
                out.add(cur.toString().trim());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        if (!cur.toString().isBlank()) out.add(cur.toString().trim());
        return out;
    }
}