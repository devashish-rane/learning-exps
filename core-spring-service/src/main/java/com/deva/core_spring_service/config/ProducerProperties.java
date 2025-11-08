package com.deva.core_spring_service.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "producer.service")
public record ProducerProperties(String baseUrl, Duration timeout) {
    public Duration timeout() {
        return timeout != null ? timeout : Duration.ofSeconds(2);
    }
}
