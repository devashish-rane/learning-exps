package com.deva.tracing;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;

@Aspect
class TraceMethodAspect {

    @Around("@within(org.springframework.web.bind.annotation.RestController) || @within(org.springframework.stereotype.Service)")
    public Object captureFlow(ProceedingJoinPoint joinPoint) throws Throwable {
        TraceRecorder.recordMethod(buildSignature(joinPoint));
        return joinPoint.proceed();
    }

    private String buildSignature(ProceedingJoinPoint joinPoint) {
        String type = joinPoint.getSignature().getDeclaringType().getSimpleName();
        return type + "#" + joinPoint.getSignature().getName() + "()";
    }
}
