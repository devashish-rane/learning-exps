package com.deva.tracing;

import java.net.URI;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.ExchangeFunction;
import reactor.core.publisher.Mono;

class TraceWebClientFilter implements ExchangeFilterFunction {

    @Override
    public Mono<ClientResponse> filter(ClientRequest request, ExchangeFunction next) {
        ClientRequest.Builder builder = ClientRequest.from(request);
        String traceparent = TraceRecorder.currentTraceparent();
        if (traceparent != null) {
            builder.headers(headers -> headers.set("traceparent", traceparent));
        }
        String traceId = TraceRecorder.currentTraceId();
        if (traceId != null) {
            builder.headers(headers -> headers.set("X-Request-Id", traceId));
        }
        ClientRequest mutated = builder.build();
        URI uri = mutated.url();
        return next.exchange(mutated)
            .doOnNext(response -> TraceRecorder.recordHttp(httpLabel(uri, response.rawStatusCode())))
            .doOnError(error -> TraceRecorder.recordHttp(httpLabel(uri, -1)));
    }

    private String httpLabel(URI uri, int status) {
        StringBuilder builder = new StringBuilder("HTTP_CLIENT ");
        builder.append(uri.getHost() == null ? "unknown" : uri.getHost());
        builder.append(' ');
        builder.append(uri.getPath());
        if (status > 0) {
            builder.append(" -> ");
            builder.append(status);
        } else {
            builder.append(" -> ERROR");
        }
        return builder.toString();
    }
}
