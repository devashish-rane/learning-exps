package com.deva.tracing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.context.annotation.EnableAspectJAutoProxy;

@Configuration
@EnableAspectJAutoProxy(proxyTargetClass = true)
public class TraceTracingConfig {

    @Bean
    public TraceSummaryFilter traceSummaryFilter(@Value("${spring.application.name:service}") String serviceName) {
        return new TraceSummaryFilter(serviceName);
    }

    @Bean
    public FilterRegistrationBean<TraceSummaryFilter> traceSummaryFilterRegistration(TraceSummaryFilter filter) {
        FilterRegistrationBean<TraceSummaryFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 5);
        return registration;
    }

    @Bean
    public TraceMethodAspect traceMethodAspect() {
        return new TraceMethodAspect();
    }

}
