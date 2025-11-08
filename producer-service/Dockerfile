# ---------- Build stage ----------
FROM maven:3.9.8-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn -q -e dependency:go-offline
COPY src ./src
RUN mvn -q -e clean package -DskipTests

# ---------- Runtime stage ----------
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8082
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Dspring.output.ansi.enabled=ALWAYS -Dlogback.stdoutImmediateFlush=true"
ENTRYPOINT ["sh","-c","java $JAVA_OPTS -jar /app/app.jar"]
