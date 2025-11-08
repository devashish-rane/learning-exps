package com.deva.core_spring_service.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
@EnableConfigurationProperties(ProducerProperties.class)
public class WebClientConfig {

    @Bean
    public WebClient producerWebClient(ProducerProperties properties) {
        return WebClient.builder()
                .baseUrl(properties.baseUrl())
                .exchangeStrategies(ExchangeStrategies.builder()
                        .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(16 * 1024))
                        .build())
                .build();
    }
}
