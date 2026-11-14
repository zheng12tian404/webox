package com.webox;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class WeBoxApplication {
    public static void main(String[] args) {
        SpringApplication.run(WeBoxApplication.class, args);
    }
}