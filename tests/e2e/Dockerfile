FROM mcr.microsoft.com/playwright:v1.52.0-noble@sha256:a021500a801bab0611049217ffad6b9697d827205c15babb86a53bc1a61c02d5

WORKDIR /tests
COPY package.json package-lock.json ./
RUN npm ci
COPY playwright.config.ts course-helpers.ts stage2a.spec.ts stage2b.spec.ts stage3.spec.ts pilot.spec.ts host-pilot.spec.ts stage4-driving.spec.ts viewer-capture.spec.ts viewer.spec.ts ./

CMD ["npx", "playwright", "test"]
