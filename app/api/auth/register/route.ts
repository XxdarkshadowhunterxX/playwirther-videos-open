// app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nome, email e senha são obrigatórios." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "A senha deve ter pelo menos 8 caracteres." },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return NextResponse.json(
        { error: "Este email já está cadastrado." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        emailVerified: new Date(), // auto-verificado no beta
      },
    });

    // Criar subscription beta + créditos iniciais
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "beta",
        status: "active",
      },
    });

    await prisma.creditsLedger.create({
      data: {
        userId: user.id,
        amount: 100,
        operation: "beta_grant",
        description: "Créditos iniciais do período beta",
        balanceAfter: 100,
      },
    });

    return NextResponse.json(
      { message: "Conta criada com sucesso!", userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("[REGISTER]", error);
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 }
    );
  }
}
