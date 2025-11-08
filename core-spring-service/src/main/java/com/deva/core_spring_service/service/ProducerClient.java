package com.deva.core_spring_service.service;

import com.deva.core_spring_service.config.CorrelationIdFilter;
import com.deva.core_spring_service.config.ProducerProperties;
import com.deva.core_spring_service.util.CorrelationIdHolder;
import com.deva.core_spring_service.model.UserStatus;
import com.deva.core_spring_service.exception.ProducerUnavailableException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;

@Service
public class ProducerClient {
    private final WebClient webClient;
    private final ProducerProperties properties;

    public ProducerClient(WebClient producerWebClient, ProducerProperties properties) {
        this.webClient = producerWebClient;
        this.properties = properties;
    }

    public UserStatus fetchStatus(String userId) {
        try {
            return request(userId)
                    .block(properties.timeout());
        } catch (Exception ex) {
            throw new ProducerUnavailableException("Producer service unavailable", ex);
        }
    }

    public boolean isHealthy() {
        try {
            webClient.get()
                    .uri("/health")
                    .accept(MediaType.TEXT_PLAIN)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(1))
                    .block();
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    private Mono<UserStatus> request(String userId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder.path("/status")
                        .queryParam("userId", userId)
                        .build())
                .accept(MediaType.APPLICATION_JSON)
                .headers(headers -> CorrelationIdHolder.get()
                        .ifPresent(id -> headers.add(CorrelationIdFilter.HEADER_NAME, id)))
                .retrieve()
                .bodyToMono(UserStatus.class);
    }
}
