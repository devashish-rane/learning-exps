## ---------- BUILD STAGE ----------
FROM maven:3.9.8-eclipse-temurin-17 AS builder
WORKDIR /app

# Copy Maven descriptor first for layer caching
COPY pom.xml .
RUN mvn -q -e dependency:go-offline -B

# Copy source code
COPY src ./src

# Build application (skip tests to speed up build)
RUN mvn -q -e clean package -DskipTests

## ---------- RUNTIME STAGE ----------
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app

# Copy JAR from builder
COPY --from=builder /app/target/*.jar /app/app.jar

EXPOSE 8080

ENV SPRING_PROFILES_ACTIVE=dev
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Dspring.output.ansi.enabled=ALWAYS -Dlogback.stdoutImmediateFlush=true"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
