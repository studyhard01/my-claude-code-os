// vitest setupFiles — 각 테스트 파일의 import 이전에 실행된다.
// db.ts(PrismaClient 싱글턴)가 로드되기 전에 DATABASE_URL 을 테스트 DB 로
// 바꿔치기해야 하므로 반드시 여기(모듈 로드 전)에서 설정한다.
process.env.DATABASE_URL = "file:./test.db";
